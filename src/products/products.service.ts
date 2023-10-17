import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { validate as isUUID } from 'uuid';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product, ProductImage } from './entities';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger('ProductsService'); // Se crea un instancia de Logger y se le indica que se va a utilizar el la clase ProductsService

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,

    @InjectRepository(ProductImage)
    private readonly productImageRepository: Repository<ProductImage>,

    private readonly dataSource: DataSource,
  ) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const { images = [], ...productDetails } = createProductDto;
      const product = this.productRepository.create({
        ...productDetails,
        // Crear la instancia para las imágenes (tabla aparte)
        images: images.map((image) =>
          this.productImageRepository.create({ url: image }),
        ),
      }); // Se crea la instancia del producto, no se graba en BD, por eso es síncrono
      await this.productRepository.save(product); // Guardar en ambas tablas
      return { ...product, images };
    } catch (error) {
      this.handleDBExceptions(error);
    }
  }

  async findAll(paginationDto) {
    const { limit = 10, offset = 0 } = paginationDto;
    const products = await this.productRepository.find({
      take: limit,
      skip: offset,
      relations: {
        images: true,
      },
    });

    return products.map((product) => ({
      ...product,
      images: product.images.map((img) => img.url),
    }));
  }

  async findOne(term: string) {
    let product: Product;

    if (isUUID(term)) {
      product = await this.productRepository.findOneBy({ id: term });
    } else {
      const queryBuilder = this.productRepository.createQueryBuilder('prod'); // prod es un alias para la tabla product
      product = await queryBuilder
        // UPPER(title) pasa a mayúsculas el valor encontrado en BD
        .where('UPPER(title) =:title or slug =:slug', {
          title: term.toUpperCase(),
          slug: term.toLowerCase(),
        })
        .leftJoinAndSelect('prod.images', 'prodImages') // prodImages es un alias para la tabla product_image
        .getOne();
    }

    if (!product)
      throw new NotFoundException(`Product with term ${term} not found`);
    return product;
  }

  // Este método se crea para devolver solo un array de imágenes y no un array de objetos.
  // De esta forma se mantiene la respuesta del findOne como una instancia que pueda ser utilizada en otros métodos.
  async findOnePlain(term: string) {
    const { images = [], ...rest } = await this.findOne(term);
    return { ...rest, images: images.map((image) => image.url) };
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const { images, ...toUpdate } = updateProductDto;

    // preload busca por el primer parámetro y carga los campos asociados (segundo parámetro)
    const product = await this.productRepository.preload({
      id,
      ...toUpdate,
    });

    if (!product)
      throw new NotFoundException(`Product with id ${id} not found`);

    // Create query runner
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (images) {
        // Eliminar las imágenes relacionadas con el productId en la tabla product_image:
        await queryRunner.manager.delete(ProductImage, { product: { id } });

        // Crear la instancia para las imágenes nuevas:
        product.images = images.map((image) =>
          this.productImageRepository.create({ url: image }),
        );
      }

      await queryRunner.manager.save(product); // En este cason no se guarda, solo verifica que no haya errores
      // await this.productRepository.save(product);
      await queryRunner.commitTransaction(); // Guarda los cambios en BD
      await queryRunner.release(); // finaliza la conexión del queryRunner
      return this.findOnePlain(id);
    } catch (error) {
      await queryRunner.rollbackTransaction(); // Devuelve los cambios si hay error
      await queryRunner.release(); // finaliza la conexión del queryRunner
      this.handleDBExceptions(error);
    }
  }

  async remove(id: string) {
    const product = await this.findOne(id);
    await this.productRepository.remove(product);
    // return await this.productRepository.delete({ id });
  }

  private handleDBExceptions(error: any) {
    if (error.code === '23505') throw new BadRequestException(error.detail);
    this.logger.error(error);
    throw new InternalServerErrorException(
      'Unexpected error, check server logs',
    );
  }

  async deleteAllProducts() {
    const query = this.productRepository.createQueryBuilder('product');

    try {
      return await query.delete().where({}).execute();
    } catch (error) {
      this.handleDBExceptions(error);
    }
  }
}
